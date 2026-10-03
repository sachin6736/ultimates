import mongoose from 'mongoose';

export const SERVICE_OPTIONS = [
  'Google Ads / PPC',
  'Meta Ads',
  'SEO',
  'Social Media Marketing',
  'Website Design & Development',
  'Landing Page',
  'Lead Generation',
  'Content Marketing',
  'Email Marketing',
  'CRM Automation',
  'WhatsApp Automation',
  'AI Social Media Automation',
  'Software / Custom Development',
  'Full Digital Marketing Package',
  'Other',
];

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: 'Digital Marketing',
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    deliverables: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

serviceSchema.index({ name: 1 });
serviceSchema.index({ status: 1 });
serviceSchema.index({ name: 'text', description: 'text', category: 'text' });

export default mongoose.model('Service', serviceSchema);
