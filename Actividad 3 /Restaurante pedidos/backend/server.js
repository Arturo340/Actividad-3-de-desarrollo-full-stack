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

const MENU = [
    {
        categoria: "Cafeteria",
        productos: [
            { sku: "CAF-001", nombre: "Cafe americano", precio: 35},
            { sku: "CAF-002", nombre: "Latte", precio: 55},
            { sku: "CAF-003", nombre: "Capuchino", precio: 55},
        ],

    },
    {
      categoria: "Comida",
      productos: [
            { sku: "COM-001", nombre: "Hamburguesa calsica", precio: 120},
            { sku: "COM-002", nombre: "Tacos (5)", precio: 95},
            { sku: "COM-003", nombre: "Ensalada", precio: 110},
        ],
      
    },
    {
        categoria: "Postres",
        productos: [
            { sku: "POS-001", nombre: "Pay de limon", precio: 60},
            { sku: "POS-002", nombre: "Brownie", precio: 65},
        ],
    },
];

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

async function obtenerPedidos() {
    await asegurarArchivoJSON(TAREAS_PATH, []);
    return await leerJSON(TAREAS_PATH);
}

async function guardarPedidos(pedidos) {
    await escribirJSON(TAREAS_PATH, pedidos);
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

app.get("/menu", (req, res) => {
    res.json({ menu: MENU });
});


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
    const pedidos = await obtenerPedidos();
    return res.json(pedidos);
}));

app.post('/tareas', autenticarToken, asyncHandler(async (req, res) => {
    const { categoria, items, cliente } = req.body;

    if (!categoria || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ 
            error: "Debes enviar categoria e items (array con al menos 1 producto)",
        });
    }

    let total =  0;
    const itemsNormalizados = items.map((it) => {
        const cantidad = Number(it.cantidad || 1);
        const sku = (it.sku || "").toString().trim();
        const nombre = (it.nombre || "").toString().trim();

        let precio = Number(it.precio || 0);

        if (!precio) {
            for (let i = 0; i < MENU.length; i++) {
                for (let j = 0; j < MENU[i].productos.length; j++) {
                    if (MENU[i].productos[j].sku === sku) {
                        precio = MENU[i].productos[j].precio;
                    }
                }
            }
        }

        total += precio * cantidad;

        return { sku, nombre, precio, cantidad};
    });

    const pedidos = await obtenerPedidos();
    

    const nuevoPedido = {
        id: Date.now().toString(),
        categoria,
        cliente: cliente || "Mostrador",
        items: itemsNormalizados,
        total,
        estado: "nuevo",
        creadaEn: new Date().toISOString(),
    };

    pedidos.push(nuevoPedido);
    await guardarPedidos(pedidos);

    res.status(201).json({ message: 'Pedido creado', pedido: nuevoPedido});

}));

app.put('/tareas/:id', autenticarToken, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { estado, cliente, categoria, items } = req.body;

    const pedidos = await obtenerPedidos();
    const index = pedidos.findIndex(t => t.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Pedido no encontrado'});

    }

    if (estado) pedidos[index].estado = estado;
    if (cliente) pedidos[index].cliente = cliente;
    if (categoria) pedidos[index].categoria = categoria;

    if (items && Array.isArray(items)) {

        let total= 0;
        const nuevosItems = items.map((it) => {
            const cantidad = Number(it.cantidad || 1);
            const precio = Number(it.precio || 0);
            total += precio * cantidad;
            return {
                sku: (it.sku || "").toString().trim(),
                nombre: (it.nombre || "").toString().trim(),
                precio,
                cantidad,
            };
        });

        pedidos[index].items = nuevosItems;
        pedidos[index].total = total;
    }

    await guardarPedidos(pedidos);
    return res.json({ message: 'Pedido actualizado', pedido: pedidos[index] });
}));

app.delete('/tareas/:id', autenticarToken, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pedidos = await obtenerPedidos();
    const index = pedidos.findIndex((p) => p.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const eliminado = pedidos.splice(index, 1)[0];
    await guardarPedidos(pedidos);

    return res.json({ message: 'Pedido eliminado', pedido: eliminado });
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