import { Link } from 'react-router-dom';
import '../styles/NotFound.css';

function NotFound() {
  return (
    <main className="not-found">
      <h1>Page not found</h1>
      <p>This address does not match a page.</p>
      <Link to="/" className="not-found__link">
        Back to catalogue
      </Link>
    </main>
  );
}

export default NotFound;
