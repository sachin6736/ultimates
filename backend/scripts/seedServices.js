import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';
import Service from '../model/Service.js';
import { DEFAULT_SERVICES } from '../controller/serviceController.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

export async function seedServices() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is missing in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('🌱 Connected to MongoDB for seeding services...');

    await Service.deleteMany({});
    console.log('🗑️ Cleared existing services.');

    const inserted = await Service.insertMany(DEFAULT_SERVICES);
    console.log(`✅ Successfully seeded ${inserted.length} digital marketing services:`);
    inserted.forEach((s, idx) => {
      console.log(`  ${idx + 1}. ${s.name} - Starts from $${s.price}`);
    });

    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB.');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedServices();
