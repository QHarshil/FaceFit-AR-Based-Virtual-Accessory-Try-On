const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5055;

// Middleware
app.use(cors());
app.use(express.json());

// Products data
const products = [
  {
    id: 1,
    name: 'Rectangular Acetate Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/glasses1.glb',
    description: 'Black rectangular full-rim frame with clear lenses.',
    dimensionsMm: {
      total: 140,
      lensWidth: 53,
      lensHeight: 33,
      bridge: 18,
      templeLength: 135,
    },
    dimensionsSource: 'nominal',
    attribution: {
      author: 'AlbertVictory',
      authorUrl: 'https://sketchfab.com/albert_victory',
      sourceUrl: 'https://sketchfab.com/3d-models/glasses-4b8a1e54f3084c63828fe8c324198aec',
      license: 'CC-BY-4.0',
      licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
  },
  {
    id: 2,
    name: 'Oval Wire-Rim Sunglasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/glasses2.glb',
    description: 'Thin metal oval frame with dark tinted lenses.',
    dimensionsMm: {
      total: 135,
      lensWidth: 52,
      lensHeight: 45,
      bridge: 20,
      templeLength: 135,
    },
    dimensionsSource: 'nominal',
    attribution: {
      author: 'Agha.Najam',
      authorUrl: 'https://sketchfab.com/Agha.Najam',
      sourceUrl: 'https://sketchfab.com/3d-models/ray-ban-glasses-bb3a3736110a41bdacc9f92e11831a41',
      license: 'CC-BY-4.0',
      licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
  },
  {
    id: 3,
    name: 'Pixel Shades (novelty)',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/glasses3.glb',
    description: 'Voxel-style novelty sunglasses.',
    dimensionsMm: {
      total: 140,
      lensWidth: 64,
      lensHeight: 29,
      bridge: 10,
      templeLength: 115,
    },
    dimensionsSource: 'nominal',
    attribution: {
      author: 'BasicModel',
      authorUrl: 'https://sketchfab.com/BasicModel',
      sourceUrl: 'https://sketchfab.com/3d-models/deal-with-it-glasses-original-1c5b6d8f43754e3ba9643b96f6e4c27e',
      license: 'CC-BY-4.0',
      licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
  },
  {
    id: 4,
    name: 'Round Wire-Rim Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/glasses4.glb',
    description: 'Small round metal frame with grey lenses and adjustable nose pads.',
    dimensionsMm: {
      total: 128,
      lensWidth: 36,
      lensHeight: 36,
      bridge: 26,
      templeLength: 150,
    },
    dimensionsSource: 'nominal',
    attribution: {
      author: 'Dokono Kinokoda',
      authorUrl: 'https://sketchfab.com/JunkWren',
      sourceUrl: 'https://sketchfab.com/3d-models/glasses-09-5d4ef7145b1b426cb129e3d661f7c2e6',
      license: 'CC-BY-4.0',
      licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
  },
];

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'FaceFit AR Backend is running' });
});

app.get('/api/products', (req, res) => {
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const product = products.find(p => p.id === parseInt(req.params.id));
  if (product) {
    res.json(product);
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

app.post('/api/telemetry', (req, res) => {
  const event = {
    receivedAt: new Date().toISOString(),
    ...req.body,
  };
  console.log('Telemetry event:', JSON.stringify(event));
  res.status(202).json({ status: 'accepted' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Serving ${products.length} products`);
});
