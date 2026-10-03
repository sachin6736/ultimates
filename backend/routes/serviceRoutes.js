import express from 'express';
import {
  createService,
  deleteService,
  getServices,
  updateService,
} from '../controller/serviceController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireAdmin } from '../controller/authController.js';

const router = express.Router();

// Viewing services is open to authenticated users (admin & agents)
router.get('/', authMiddleware, getServices);

// Management actions are restricted to Admin only
router.post('/', authMiddleware, requireAdmin, createService);
router.put('/:id', authMiddleware, requireAdmin, updateService);
router.delete('/:id', authMiddleware, requireAdmin, deleteService);

export default router;
