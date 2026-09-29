import express from 'express';
import {
  register,
  login,
  logout,
  getCurrentUser,
  getUsers,
  getAdminActivityStats,
  changePassword,
  requireAdmin,
  updateLeadAssignmentStatus,
  updateMyAiReplyStatus,
  updateUserAiReplyStatus
} from '../controller/authController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', authMiddleware, logout);

router.get('/me', authMiddleware, getCurrentUser);
router.patch('/me/ai-reply-status', authMiddleware, updateMyAiReplyStatus);
router.get('/users', authMiddleware, requireAdmin, getUsers);
router.patch('/users/:id/assignment-status', authMiddleware, requireAdmin, updateLeadAssignmentStatus);
router.patch('/users/:id/ai-reply-status', authMiddleware, requireAdmin, updateUserAiReplyStatus);
router.get('/admin-activity-stats', authMiddleware, requireAdmin, getAdminActivityStats);
router.post('/change-password', authMiddleware, changePassword);

export default router;
