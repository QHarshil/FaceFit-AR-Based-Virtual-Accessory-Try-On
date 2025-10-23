import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import TryOn from './pages/TryOn';
import './styles/App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/try-on/:id" element={<TryOn />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;

