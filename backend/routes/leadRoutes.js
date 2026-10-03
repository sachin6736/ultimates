import express from 'express';
import { addLeadNote, completeLeadFollowUp, createLead, getLeads, updateLeadDisposition, updateLeadFollowUp, updateLeadLostReason } from '../controller/leadController.js';
import authMiddleware, { optionalAuthMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', optionalAuthMiddleware, createLead);
router.get('/', authMiddleware, getLeads);
router.patch('/:id/disposition', authMiddleware, updateLeadDisposition);
router.patch('/:id/lost-reason', authMiddleware, updateLeadLostReason);
router.post('/:id/notes', authMiddleware, addLeadNote);
router.patch('/:id/follow-up', authMiddleware, updateLeadFollowUp);
router.patch('/:id/follow-up/complete', authMiddleware, completeLeadFollowUp);

export default router;
