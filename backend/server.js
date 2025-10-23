const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Products data
const products = [
  {
    id: 1,
    name: 'Aviator Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/glasses1.glb',
    description: 'Classic aviator style glasses',
  },
  {
    id: 2,
    name: 'Round Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/glasses2.glb',
    description: 'Vintage round frame glasses',
  },
  {
    id: 3,
    name: 'Square Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/glasses3.glb',
    description: 'Modern square design glasses',
  },
  {
    id: 4,
    name: 'Cat Eye Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/glasses4.glb',
    description: 'Elegant cat eye frame glasses',
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
