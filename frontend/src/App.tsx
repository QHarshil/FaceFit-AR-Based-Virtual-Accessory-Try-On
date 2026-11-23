import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import TryOn from './pages/TryOn';
import './styles/App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/try-on/:id" element={<TryOn />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
