const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

function App() {
  return (
    <main className="app-shell">
      <h1>WFConnect Timeclock</h1>
      <p>Minimal web app scaffold is ready.</p>
      <p>
        API base URL: <strong>{apiBaseUrl}</strong>
      </p>
    </main>
  );
}

export default App;
