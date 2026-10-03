import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    companyName: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    serviceInterestedIn: {
      type: String,
      required: false,
      trim: true,
      default: 'Google Ads / PPC',
    },
    industry: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    businessType: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    websiteUrl: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    disposition: {
      type: String,
      required: false,
      enum: [
        'New Lead',
        'Contact Attempted',
        'Contacted',
        'Qualified',
        'Proposal Sent',
        'Negotiation',
        'Payment Pending',
        'Won – Client',
        'Won - Client',
        'Lost',
        'Follow Up Later',
      ],
      default: 'New Lead',
    },
    lostReason: {
      type: String,
      required: false,
      enum: [
        'Price too high',
        'Went with competitor',
        'Not interested',
        'No response',
        'Budget unavailable',
        'Delayed project',
        'Service not required',
        'Bad / fake lead',
        'Other',
        '',
        null,
      ],
      default: '',
    },
    lostReasonDetails: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    source: {
      type: String,
      enum: ['manual', 'website', 'facebook', 'other'],
      default: 'manual',
    },
    followUpAt: {
      type: Date,
      default: null,
    },
    followUp: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FollowUp',
      default: null,
    },
    followUpNote: {
      type: String,
      trim: true,
      default: '',
    },
    followUpSetBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    followUpRemindedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Lead', leadSchema);
