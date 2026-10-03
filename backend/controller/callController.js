import CallLog from '../model/CallLog.js';
import CallTranscript from '../model/CallTranscript.js';
import Contact from '../model/Contact.js';
import InboundCallSession from '../model/InboundCallSession.js';
import Lead from '../model/Lead.js';
import User from '../model/User.js';
import { buildCallAccessQuery } from '../utils/callAccess.js';
import { consolidateAdminCallLogs } from '../utils/consolidateCallLogs.js';
import { findInboundSession } from '../utils/inboundCallSession.js';
import { buildPaginatedResponse, parseBeforeDate, parseLimit } from '../utils/pagination.js';
import { buildPhonePatterns, buildPhoneOrFilter } from '../utils/phoneMatch.js';
import { getAssignedNumberForUser } from '../utils/twilioNumbers.js';

const createTeammateCallLogs = async (session, answererId) => {
  const otherUserIds = (session.assignedUserIds || [])
    .map((userId) => String(userId))
    .filter((userId) => userId && userId !== String(answererId));

  if (otherUserIds.length === 0) return;

  const now = new Date();
  await Promise.all(otherUserIds.map((userId) => CallLog.findOneAndUpdate(
    { callSid: session.callSid, user: userId },
    {
      $setOnInsert: {
        user: userId,
        phoneNumber: session.phoneNumber,
        localNumber: session.localNumber,
        callType: 'inbound',
        duration: 0,
        status: 'answered-by-teammate',
        answeredBy: answererId,
        callSid: session.callSid,
        startedAt: now,
        endedAt: now
      }
    },
    { upsert: true, setDefaultsOnInsert: true }
  )));
};

const formatCallLog = (log, phoneMap = new Map()) => {
  const item = log.toObject ? log.toObject() : log;
  const digits = String(item.phoneNumber || '').replace(/\D/g, '');
  const digits10 = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const phoneInfo = phoneMap.get(item.phoneNumber) || phoneMap.get(digits) || phoneMap.get(digits10) || {};

  return {
    ...item,
    userName: item.user?.name || 'Unknown User',
    userEmail: item.user?.email || '',
    answeredByName: item.answeredBy?.name || '',
    contactName: phoneInfo.contactName || '',
    contactCompany: phoneInfo.contactCompany || ''
  };
};

export const saveCallLog = async (req, res) => {
  try {
    const { phoneNumber, callType, duration = 0, status, callSid, localNumber, answeredBy } = req.body;
    const resolvedCallType = callType || 'outbound';
    const startedAt = new Date();
    const transcriptQuery = {
      $or: [
        ...(callSid ? [{ callSid }] : []),
        {
          phoneNumber,
          callType: resolvedCallType,
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      ]
    };
    const transcript = await CallTranscript.findOne(transcriptQuery).sort({ updatedAt: -1 });
    const resolvedLocalNumber = String(localNumber || transcript?.localNumber || '').trim()
      || (resolvedCallType === 'outbound' ? await getAssignedNumberForUser(req.user.id) : '');

    let resolvedAnsweredBy = answeredBy || undefined;
    if (status === 'answered-by-teammate' && !resolvedAnsweredBy) {
      const session = await findInboundSession({ callSid, phoneNumber, localNumber: resolvedLocalNumber });
      resolvedAnsweredBy = session?.answeredBy || undefined;
    }

    const callLogData = {
      user: req.user.id,
      phoneNumber,
      localNumber: resolvedLocalNumber,
      callType: resolvedCallType,
      duration: Number(duration) || 0,
      status: status || 'completed',
      callSid,
      answeredBy: resolvedAnsweredBy,
      transcriptionText: transcript?.text || '',
      transcriptionStatus: transcript?.status || 'not-started',
      transcriptionSid: transcript?.transcriptionSid || '',
      transcriptionSegments: transcript?.segments || [],
      transcriptionError: transcript?.error || '',
      startedAt,
      endedAt: startedAt
    };

    const duplicateQuery = callSid
      ? { callSid, user: req.user.id }
      : {
          user: req.user.id,
          phoneNumber,
          localNumber: resolvedLocalNumber,
          callType: resolvedCallType,
          status: status || 'completed',
          startedAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) }
        };

    const callLog = callSid || resolvedCallType === 'inbound'
      ? await CallLog.findOneAndUpdate(
          duplicateQuery,
          { $set: callLogData },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        )
      : await CallLog.create(callLogData);

    console.log('Call Log', callLog);

    res.status(201).json({ message: 'Call logged successfully', callLog });
  } catch (error) {
    console.error('Save Call Log Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const markCallAnswered = async (req, res) => {
  try {
    const { callSid, phoneNumber, localNumber } = req.body;
    const session = await findInboundSession({ callSid, phoneNumber, localNumber });

    if (!session) {
      return res.status(404).json({ message: 'Inbound call session not found' });
    }

    if (session.status === 'answered' && session.answeredBy) {
      const answerer = await User.findById(session.answeredBy).select('name email');
      return res.json({
        alreadyAnswered: true,
        session,
        parentCallSid: session.callSid,
        answeredBy: session.answeredBy,
        answeredByName: answerer?.name || 'Teammate'
      });
    }

    const updatedSession = await InboundCallSession.findOneAndUpdate(
      { callSid: session.callSid, status: 'ringing' },
      {
        $set: {
          status: 'answered',
          answeredBy: req.user.id,
          answeredAt: new Date()
        }
      },
      { new: true }
    );

    if (!updatedSession) {
      const current = await findInboundSession({ callSid: session.callSid });
      const answerer = current?.answeredBy
        ? await User.findById(current.answeredBy).select('name email')
        : null;

      return res.json({
        alreadyAnswered: true,
        session: current,
        parentCallSid: current?.callSid,
        answeredBy: current?.answeredBy,
        answeredByName: answerer?.name || 'Teammate'
      });
    }

    await createTeammateCallLogs(updatedSession, req.user.id);

    const answerer = await User.findById(req.user.id).select('name email');
    const io = req.app.get('io');
    if (io) {
      io.emit('call-answered-by-teammate', {
        callSid: updatedSession.callSid,
        parentCallSid: updatedSession.callSid,
        phoneNumber: updatedSession.phoneNumber,
        localNumber: updatedSession.localNumber,
        answeredBy: req.user.id,
        answeredByName: answerer?.name || 'Teammate',
        assignedUserIds: updatedSession.assignedUserIds.map((id) => String(id))
      });
      io.emit('refresh-call-history');
    }

    res.json({
      session: updatedSession,
      parentCallSid: updatedSession.callSid,
      answeredBy: req.user.id,
      answeredByName: answerer?.name || 'Teammate'
    });
  } catch (error) {
    console.error('Mark Call Answered Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getInboundSession = async (req, res) => {
  try {
    const { callSid } = req.params;
    if (!callSid) {
      return res.status(400).json({ message: 'callSid is required' });
    }

    const { phoneNumber, localNumber } = req.query;
    const session = await findInboundSession({
      callSid,
      phoneNumber,
      localNumber
    });

    if (!session) {
      return res.status(404).json({ message: 'Inbound call session not found' });
    }

    await session.populate('answeredBy', 'name email');

    res.json({
      callSid: session.callSid,
      parentCallSid: session.callSid,
      phoneNumber: session.phoneNumber,
      localNumber: session.localNumber,
      status: session.status,
      answeredBy: session.answeredBy?._id || session.answeredBy || null,
      answeredByName: session.answeredBy?.name || '',
      assignedUserIds: session.assignedUserIds.map((id) => String(id))
    });
  } catch (error) {
    console.error('Get Inbound Session Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getCallLogs = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const before = parseBeforeDate(req.query.before);
    const phoneNumber = String(req.query.phoneNumber || '').trim();
    const search = String(req.query.search || '').trim();
    const filters = [];

    if (phoneNumber) {
      filters.push(buildPhoneOrFilter(phoneNumber, ['phoneNumber']));
    } else {
      const accessQuery = await buildCallAccessQuery(req.user);
      if (Object.keys(accessQuery).length > 0) {
        filters.push(accessQuery);
      }
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      const searchDigits = search.replace(/\D/g, '');

      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { email: searchRegex }]
      }).select('_id');
      const matchingUserIds = matchingUsers.map((u) => u._id);

      const contactQuery = {
        $or: [{ name: searchRegex }, { company: searchRegex }]
      };
      if (req.user.role !== 'admin') {
        contactQuery.user = req.user.id;
      }
      const matchingContacts = await Contact.find(contactQuery).select('phone');

      const leadQuery = {
        $or: [{ name: searchRegex }, { serviceInterestedIn: searchRegex }]
      };
      const matchingLeads = await Lead.find(leadQuery).select('phone');

      const matchedPhones = [
        ...matchingContacts.map((c) => c.phone),
        ...matchingLeads.map((l) => l.phone)
      ].filter(Boolean);

      const matchedPhonePatterns = matchedPhones.flatMap(buildPhonePatterns);

      const searchOr = [
        { phoneNumber: searchRegex },
        { localNumber: searchRegex }
      ];

      if (searchDigits.length >= 3) {
        searchOr.push({ phoneNumber: new RegExp(searchDigits) });
        searchOr.push({ localNumber: new RegExp(searchDigits) });
      }

      if (matchingUserIds.length > 0) {
        searchOr.push({ user: { $in: matchingUserIds } });
        searchOr.push({ answeredBy: { $in: matchingUserIds } });
      }

      if (matchedPhonePatterns.length > 0) {
        searchOr.push({ phoneNumber: { $in: matchedPhonePatterns } });
      }

      filters.push({ $or: searchOr });
    }

    const query = filters.length > 1
      ? { $and: filters }
      : (filters[0] || {});

    if (before) {
      query.startedAt = { $lt: before };
    }

    const logs = await CallLog.find(query)
      .populate('user', 'name email role')
      .populate('answeredBy', 'name email')
      .sort({ startedAt: -1, _id: -1 })
      .limit(limit + 1);

    const uniquePhones = [...new Set(logs.map((l) => l.phoneNumber).filter(Boolean))];
    const phoneMap = new Map();

    if (uniquePhones.length > 0) {
      const allPhonePatterns = uniquePhones.flatMap(buildPhonePatterns);
      const [contacts, leads] = await Promise.all([
        Contact.find({ phone: { $in: allPhonePatterns } }).select('name company phone user'),
        Lead.find({ phone: { $in: allPhonePatterns } }).select('name phone')
      ]);

      leads.forEach((l) => {
        buildPhonePatterns(l.phone).forEach((p) => {
          if (!phoneMap.has(p)) {
            phoneMap.set(p, { contactName: l.name, contactCompany: '' });
          }
        });
      });

      contacts.forEach((c) => {
        buildPhonePatterns(c.phone).forEach((p) => {
          const existing = phoneMap.get(p) || {};
          phoneMap.set(p, {
            contactName: c.name || existing.contactName || '',
            contactCompany: c.company || existing.contactCompany || ''
          });
        });
      });
    }

    const formattedLogs = logs.map((log) => formatCallLog(log, phoneMap));
    const page = buildPaginatedResponse(
      formattedLogs,
      limit,
      (log) => new Date(log.startedAt || log.createdAt || 0).toISOString()
    );
    page.items = req.user.role === 'admin'
      ? consolidateAdminCallLogs(page.items)
      : page.items;

    res.json(page);
  } catch (error) {
    console.error('Get Call Logs Error:', error);
    res.status(500).json({ message: error.message });
  }
};
