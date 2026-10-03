import Service, { SERVICE_OPTIONS } from '../model/Service.js';

export const DEFAULT_SERVICES = [
  {
    name: 'Google Ads / PPC',
    category: 'Paid Advertising',
    price: 499,
    currency: 'USD',
    description: 'Search, Display, Performance Max & Remarketing campaigns setup & ROI optimization.',
    deliverables: ['Account Audit', 'Keyword Research', 'Ad Copywriting', 'Conversion Tracking', 'Weekly Optimization'],
    status: 'active',
  },
  {
    name: 'Meta Ads',
    category: 'Paid Advertising',
    price: 399,
    currency: 'USD',
    description: 'Facebook & Instagram targeted advertising, custom audience building & creative ad scaling.',
    deliverables: ['Audience Targeting', 'Ad Creatives Design', 'Pixel & CAPI Setup', 'A/B Split Testing', 'Retargeting Funnel'],
    status: 'active',
  },
  {
    name: 'SEO',
    category: 'Organic Growth',
    price: 499,
    currency: 'USD',
    description: 'Comprehensive on-page, off-page & technical SEO to rank higher on Google search results.',
    deliverables: ['Keyword Mapping', 'On-Page Optimization', 'Technical Audit', 'High-DA Backlinks', 'Monthly Progress Report'],
    status: 'active',
  },
  {
    name: 'Social Media Marketing',
    category: 'Social Media',
    price: 349,
    currency: 'USD',
    description: 'Organic brand growth, engaging graphic post creation & consistent multi-platform management.',
    deliverables: ['Content Calendar', 'Custom Post Graphics', 'Hashtag Strategy', 'Audience Engagement', 'Analytics Review'],
    status: 'active',
  },
  {
    name: 'Website Design & Development',
    category: 'Development',
    price: 799,
    currency: 'USD',
    description: 'Modern, fast, mobile-responsive custom websites engineered to convert visitors into customers.',
    deliverables: ['Responsive UI/UX Design', 'Fast Loading Speed', 'SEO Friendly Structure', 'Lead Form Integrations', 'Domain & Hosting Setup'],
    status: 'active',
  },
  {
    name: 'Landing Page',
    category: 'Development',
    price: 299,
    currency: 'USD',
    description: 'High-converting, sales-focused landing pages with persuasive copywriting and clear CTAs.',
    deliverables: ['Conversion Architecture', 'Direct-Response Copy', 'Speed Optimization', 'Analytics & Heatmaps', 'CRM Webhook Integration'],
    status: 'active',
  },
  {
    name: 'Lead Generation',
    category: 'Sales Pipeline',
    price: 449,
    currency: 'USD',
    description: 'Targeted B2B and B2C prospecting pipelines delivering pre-qualified, sales-ready leads.',
    deliverables: ['Ideal Customer Profile', 'Verified Contact Lists', 'Outbound Outreach Sequences', 'Lead Scoring', 'Direct CRM Handoff'],
    status: 'active',
  },
  {
    name: 'Content Marketing',
    category: 'Organic Growth',
    price: 299,
    currency: 'USD',
    description: 'Authority-building SEO blog posts, articles, ebooks, and strategic brand storytelling.',
    deliverables: ['Content Strategy', 'SEO-Optimized Articles', 'Topic Research', 'Lead Magnets', 'Internal Linking Plan'],
    status: 'active',
  },
  {
    name: 'Email Marketing',
    category: 'Automation',
    price: 249,
    currency: 'USD',
    description: 'Automated email sequences, welcome series, newsletter campaigns & customer retention funnels.',
    deliverables: ['Template Design', 'Drip Sequences', 'List Segmentation', 'Spam Score Testing', 'Deliverability Optimization'],
    status: 'active',
  },
  {
    name: 'CRM Automation',
    category: 'Automation',
    price: 399,
    currency: 'USD',
    description: 'Full CRM setup, automated lead assignment, pipeline deal stages & automated reminders.',
    deliverables: ['Pipeline Customization', 'Workflow Automation', 'Lead Rotation Setup', 'Third-Party Webhooks', 'Team Training Walkthrough'],
    status: 'active',
  },
  {
    name: 'WhatsApp Automation',
    category: 'Automation',
    price: 299,
    currency: 'USD',
    description: 'Automated WhatsApp chatbots, instant inquiry replies, broadcast messaging & CRM sync.',
    deliverables: ['Business API Setup', 'Interactive Menus', 'Automated Greeting & Routing', 'Lead Capture Formats', 'CRM Integration'],
    status: 'active',
  },
  {
    name: 'AI Social Media Automation',
    category: 'AI & Automation',
    price: 399,
    currency: 'USD',
    description: 'AI-driven social media content generation, smart automated comments & 24/7 engagement.',
    deliverables: ['AI Prompt Engineering', 'Automated Post Scheduling', 'Auto-Reply Rules', 'Trend Discovery Bot', 'Brand Tone Calibration'],
    status: 'active',
  },
  {
    name: 'Software / Custom Development',
    category: 'Development',
    price: 999,
    currency: 'USD',
    description: 'Bespoke web applications, custom API integrations, internal business tools & portals.',
    deliverables: ['Architecture Planning', 'Frontend & Backend Build', 'Secure Database Setup', 'Custom API Integrations', 'Deployment & Handover'],
    status: 'active',
  },
  {
    name: 'Full Digital Marketing Package',
    category: 'All-in-One Package',
    price: 1499,
    currency: 'USD',
    description: 'Comprehensive 360-degree marketing package combining Ads, SEO, Content, Social Media & CRM.',
    deliverables: ['Dedicated Account Manager', 'Google & Meta Ads', 'Complete SEO Optimization', 'Social Media Management', 'CRM & WhatsApp Automation'],
    status: 'active',
  },
  {
    name: 'Other',
    category: 'Custom Service',
    price: 199,
    currency: 'USD',
    description: 'Tailored digital marketing, workflow automation, or custom technical solutions.',
    deliverables: ['Custom Scope of Work', 'Dedicated Consultation', 'Milestone-Based Delivery', 'Direct Support'],
    status: 'active',
  },
];

export const ensureDefaultServices = async () => {
  try {
    const count = await Service.countDocuments();
    if (count === 0) {
      console.log('🌱 Seeding initial 15 agency services into MongoDB...');
      await Service.insertMany(DEFAULT_SERVICES);
      console.log('✅ Successfully seeded default agency services.');
    }
  } catch (error) {
    console.warn('Could not initialize default services:', error.message);
  }
};

const clean = (val) => String(val ?? '').trim();

export const getServices = async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      sort = 'newest',
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (search && search.trim()) {
      const q = clean(search);
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } },
      ];
    }

    let sortObj = { createdAt: -1 };
    if (sort === 'oldest') sortObj = { createdAt: 1 };
    if (sort === 'price_asc') sortObj = { price: 1, name: 1 };
    if (sort === 'price_desc') sortObj = { price: -1, name: 1 };
    if (sort === 'name_asc') sortObj = { name: 1 };
    if (sort === 'name_desc') sortObj = { name: -1 };

    const [services, total, activeCount] = await Promise.all([
      Service.find(filter).sort(sortObj).skip(skip).limit(limitNum).lean(),
      Service.countDocuments(filter),
      Service.countDocuments({ status: 'active' }),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    res.json({
      success: true,
      services,
      parts: services, // Backward compatibility alias
      options: SERVICE_OPTIONS,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
      summary: {
        total,
        active: activeCount,
      },
    });
  } catch (error) {
    console.error('getServices error:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch services' });
  }
};

export const createService = async (req, res) => {
  try {
    const {
      name,
      price,
      currency = 'USD',
      description = '',
      deliverables = [],
      status = 'active',
      category = 'Digital Marketing',
    } = req.body;

    const cleanName = clean(name);
    if (!cleanName) {
      return res.status(400).json({ message: 'Service name is required' });
    }

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ message: 'A valid starting price (>= 0) is required' });
    }

    const service = await Service.create({
      name: cleanName,
      price: priceNum,
      currency: clean(currency || 'USD').toUpperCase(),
      description: clean(description),
      deliverables: Array.isArray(deliverables) ? deliverables.map(clean).filter(Boolean) : [],
      status: status === 'inactive' ? 'inactive' : 'active',
      category: clean(category) || 'Digital Marketing',
      createdBy: req.user?.id || null,
    });

    res.status(201).json({
      success: true,
      message: 'Service added successfully',
      service,
      part: service, // Backward compatibility alias
    });
  } catch (error) {
    console.error('createService error:', error);
    res.status(500).json({ message: error.message || 'Failed to create service' });
  }
};

export const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      price,
      currency,
      description,
      deliverables,
      status,
      category,
    } = req.body;

    const updateData = {};

    if (name !== undefined) {
      const cleanName = clean(name);
      if (!cleanName) return res.status(400).json({ message: 'Service name cannot be empty' });
      updateData.name = cleanName;
    }

    if (price !== undefined) {
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ message: 'A valid starting price (>= 0) is required' });
      }
      updateData.price = priceNum;
    }

    if (currency !== undefined) {
      updateData.currency = clean(currency || 'USD').toUpperCase();
    }

    if (description !== undefined) {
      updateData.description = clean(description);
    }

    if (deliverables !== undefined) {
      updateData.deliverables = Array.isArray(deliverables) ? deliverables.map(clean).filter(Boolean) : [];
    }

    if (status !== undefined) {
      updateData.status = status === 'inactive' ? 'inactive' : 'active';
    }

    if (category !== undefined) {
      updateData.category = clean(category) || 'Digital Marketing';
    }

    const service = await Service.findByIdAndUpdate(id, updateData, { new: true });

    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json({
      success: true,
      message: 'Service updated successfully',
      service,
      part: service, // Backward compatibility alias
    });
  } catch (error) {
    console.error('updateService error:', error);
    res.status(500).json({ message: error.message || 'Failed to update service' });
  }
};

export const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const service = await Service.findByIdAndDelete(id);

    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json({
      success: true,
      message: 'Service deleted successfully',
    });
  } catch (error) {
    console.error('deleteService error:', error);
    res.status(500).json({ message: error.message || 'Failed to delete service' });
  }
};
