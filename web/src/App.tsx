import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Home } from './pages/Home';
import { ItemList } from './pages/ItemList';
import { Login } from './pages/Login';
import { Viewer } from './pages/Viewer';

export function App() {
  const { status } = useAuth();
  if (status === 'loading') return null;
  // signed out: only the password page, no data and no routes
  if (status === 'out') return <Login />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/c/:cid" element={<ItemList mode="category" />} />
        <Route path="/all" element={<ItemList mode="all" />} />
        <Route path="/v/:id" element={<Viewer />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
