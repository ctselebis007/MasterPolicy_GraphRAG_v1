import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import SetupPage from './components/SetupPage';
import QAChat from './components/QAChat';
import SetupSimpleRAG from './components/SetupSimpleRAG';
import SimpleQAChat from './components/SimpleQAChat';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/setup" replace />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/qa" element={<QAChat />} />
        <Route path="/simple-setup" element={<SetupSimpleRAG />} />
        <Route path="/simple-qa" element={<SimpleQAChat />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
