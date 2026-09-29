import { useState } from 'react';
import InlineLoader from '../components/ui/InlineLoader.jsx';

import { BACKEND_URL } from '../config/api.js';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('token', data.token);
        window.location.reload(); // Refresh to show main app
      } else {
        setError(data.message || 'Invalid credentials');
      }
    } catch (err) {
      setError('Network error. Please check your connection.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-white">Ultimate</h1>
          <p className="text-gray-400 mt-2 text-sm">Professional Business Phone System</p>
        </div>

        <div className="bg-gray-900/70 backdrop-blur-xl border border-gray-700 rounded-2xl p-6 shadow-2xl">
          <h2 className="text-xl font-semibold text-white text-center mb-6">Sign In</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-gray-400 text-xs block mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-sm text-white rounded-xl px-4 py-3 focus:border-[#059669] transition"
                placeholder="you@company.com"
                required
              />
            </div>

            <div>
              <label className="text-gray-400 text-xs block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-sm text-white rounded-xl px-4 py-3 focus:border-[#059669] transition"
                placeholder="••••••••"
                required
              />
            </div>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#059669] hover:bg-[#047857] text-white font-semibold py-3 rounded-xl text-sm transition disabled:opacity-70"
            >
              {loading ? <InlineLoader label="Signing In..." /> : 'Sign In'}
            </button>
          </form>
        </div>

        {/* <p className="text-center text-gray-500 text-sm mt-6">
          First time? Register using Postman for now.
        </p> */}
      </div>
    </div>
  );
}

export default Login;
