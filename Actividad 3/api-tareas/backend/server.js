const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;

const JWT_SECRET = 'clave_secreta';

app.use(bodyParser.json());

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

const TAREAS_PATH = path.join(__dirname, 'tareas.json');
const USERS_PATH = path.join(__dirname, 'users.json');

async function asegurarArchivoJSON(ruta, valorInicial) {
    try {
        await fs.access(ruta);
    } catch (_) {
        await fs.writeFile(ruta, JSON.stringify(valorInicial, null, 2), 'utf8');
    }
}

async function leerJSON(ruta) {
    const data = await fs.readFile(ruta, 'utf8');
    return JSON.parse(data);
}

async function escribirJSON(ruta, contenido) {
    await fs.writeFile(ruta, JSON.stringify(contenido, null, 2), 'utf8');
}

async function obtenerTareas() {
    return await leerJSON(TAREAS_PATH);
}

async function guardarTareas(tareas) {
    await escribirJSON(TAREAS_PATH, tareas);
}

async function obtenerUsuarios() {
    return await leerJSON(USERS_PATH);
}

async function guardarUsuarios(usuarios) {
    await escribirJSON(USERS_PATH, usuarios);
}

function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(401).json({ error: 'Acceso denegado: falta el header Authorization'});

    }

    const partes = authHeader.split(' ');
    if (partes.length !== 2 || partes[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Formato de Authorization invalido. Usa: Bearer <token>'});
    }

    const token = partes[1];

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token invalido o expirado'});
        req.user = user;
        next();
    });
}

function asyncHandler(fn) {
    return function (req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

app.post('/register', asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'username y password son obligatorios'});
    }

    const usuarios = await obtenerUsuarios();
    const yaExiste = usuarios.some(u => u.username === username);

    if (yaExiste) {
        return res.status(409).json({ error: 'Ese usaurio ya existe'});
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const nuevoUsuario = {
        id: Date.now().toString(),
        username,
        passwordHash
    };

    usuarios.push(nuevoUsuario);
    await guardarUsuarios(usuarios);

    return res.status(201).json({ message: 'Usuarios registrado correctamente'});
}));

app.post('/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password){
        return res.status(400).json({ error: 'username y password son obligatorios'});
    }

    const usuarios = await obtenerUsuarios();
    const user = usuarios.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ error: 'Credenciales incorrectas'});
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
        return res.status(401).json({ error: 'Credenciales incorrectas'});
    }

    const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '1h'}
    );

    return res.json({ token });
}));

app.get('/tareas', autenticarToken, asyncHandler(async (req, res) => {
    const tareas = await obtenerTareas();
    return res.json(tareas);
}));

app.post('/tareas', autenticarToken, asyncHandler(async (req, res) => {
    const { titulo, descripcion } = req.body;

    if (!titulo || !descripcion) {
        return res.status(400).json({ error: 'titulo y descripcion son obligatorios'});
    }

    const tareas = await obtenerTareas();

    const nueva = {
        id: Date.now().toString(),
        titulo,
        descripcion,
        creadaEn: new Date().toISOString()
    };

    tareas.push(nueva);
    await guardarTareas(tareas);

    return res.status(201).json({ message: 'Tarea creada', tarea: nueva});

}));

app.put('/tareas/:id', autenticarToken, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { titulo, descripcion } = req.body;

    const tareas = await obtenerTareas();
    const index = tareas.findIndex(t => t.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Tarea no encontrada'});

    }

    if (titulo) tareas[index].titulo = titulo;
    if (descripcion) tareas[index].descripcion = descripcion;

    await guardarTareas(tareas);
    return res.json({ message: 'Tarea actualizada', tarea: tareas[index] });
}));

app.delete('/tareas/:id', autenticarToken, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const tareas = await obtenerTareas();
    const index = tareas.findIndex(t => t.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    const eliminada = tareas.splice(index, 1)[0];
    await guardarTareas(tareas);

    return res.json({ message: 'Tarea eliminada', tarea: eliminada });
}));

app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada'});

});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Error en el servidor'});
});

async function start() {
    await asegurarArchivoJSON(TAREAS_PATH, []);
    await asegurarArchivoJSON(USERS_PATH, []);

    app.listen(PORT, () => {
        console.log(`Servidor corriendo en el puerto ${PORT}`);
    });
}

start();