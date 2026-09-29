import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import callRoutes from './routes/callRoutes.js';
import authRoutes from './routes/authRoutes.js';
import twilioRoutes from './routes/twilioRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import followUpRoutes from './routes/followUpRoutes.js';
import phoneNumberRoutes from './routes/phoneNumberRoutes.js';
import internalMessageRoutes from './routes/internalMessageRoutes.js';
import conversationRoutes from './routes/conversationRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import partRoutes from './routes/partRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

connectDB();

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

const allowedOrigins = [
  ...(process.env.FRONTEND_URL || '').split(','),
  ...(process.env.FRONTEND_URLS || '').split(',')
]
  .map((origin) => origin?.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

const io = new Server(server, {
  cors: corsOptions
});

// Make io accessible in controllers
app.set('io', io);

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/twilio', twilioRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/followups', followUpRoutes);
app.use('/api/phone-numbers', phoneNumberRoutes);
app.use('/api/internal-messages', internalMessageRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/parts', partRoutes);

app.get('/', (req, res) => res.send('✅ VoIP Backend is Running'));
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// Socket Connection
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.data.userId = String(decoded.id);
    next();
  } catch {
    next(new Error('Authentication required'));
  }
});

io.on('connection', (socket) => {
  console.log('⚡ User connected:', socket.id);

  socket.join(socket.data.userId);

  socket.on('join-user-room', () => {
    socket.join(socket.data.userId);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export { io }; // Optional export
