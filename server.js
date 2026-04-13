require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
app.use(express.static('public'));

// ==================== MongoDB Rate Limiting ====================
const rateLimitSchema = new mongoose.Schema({
  ip: String,
  timestamp: { type: Date, default: Date.now, expires: 60 } // auto-delete after 60 sec
});

const RateLimit = mongoose.model('RateLimit', rateLimitSchema);

// Connect to MongoDB (using environment variable)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// Rate limiting middleware
async function rateLimitMiddleware(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  
  const count = await RateLimit.countDocuments({ ip, timestamp: { $gt: oneMinuteAgo } });
  if (count >= 10) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  await RateLimit.create({ ip });
  next();
}

// ==================== API Configuration (same as original, but we only check existence) ====================
const API_CONFIG = {
  mobile: {
    url: 'https://ayaanmods.site/number.php?key=annonymous&number={}',
    param: 'number',
    extractCount: (data) => {
      // If response has data object with keys, count non-empty fields
      if (data && typeof data === 'object') {
        // Exclude common metadata fields
        const exclude = ['status', 'message', 'developer', 'powered_by', '___________________________'];
        let count = 0;
        for (let key in data) {
          if (!exclude.includes(key) && data[key] && typeof data[key] !== 'object') count++;
        }
        return count;
      }
      return 0;
    }
  },
  aadhaar: {
    url: 'https://users-xinfo-admin.vercel.app/api?key=7demo&type=aadhar&term={}',
    param: 'match',
    extractCount: (data) => {
      if (data && data.tag) return 1; // presence of tag field indicates found
      if (data && Object.keys(data).length > 0) return 1;
      return 0;
    }
  },
  vehicle: {
    url: 'https://vehicle-info-aco-api.vercel.app/info?vehicle={}',
    param: 'vehicle',
    extractCount: (data) => {
      if (data && data.registration_number) return 1;
      if (data && data.error) return 0;
      return Object.keys(data).length > 0 ? 1 : 0;
    }
  },
  ration: {
    url: 'https://number8899.vercel.app/?type=family&aadhar={}',
    param: 'id',
    extractCount: (data) => {
      if (data && data.family_members && Array.isArray(data.family_members)) return data.family_members.length;
      if (data && data.error) return 0;
      return Object.keys(data).length > 0 ? 1 : 0;
    }
  }
};

// ==================== API Endpoint ====================
app.get('/api/check', rateLimitMiddleware, async (req, res) => {
  const { type, input } = req.query;
  if (!type || !input) {
    return res.status(400).json({ error: 'Missing type or input' });
  }

  const config = API_CONFIG[type];
  if (!config) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  try {
    const url = config.url.replace('{}', encodeURIComponent(input));
    console.log(`🔍 Checking ${type}: ${url}`);
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const data = response.data;
    let count = 0;
    if (config.extractCount) {
      count = config.extractCount(data);
    } else {
      // fallback: if data is object with keys and not error, count = 1
      if (data && typeof data === 'object' && !data.error) count = 1;
    }

    const found = count > 0;
    res.json({
      found,
      count,
      message: found
        ? '⚠️ Your data may be exposed in public or unsecured databases'
        : '✅ No data found in scanned sources'
    });
  } catch (error) {
    console.error(`API error for ${type}:`, error.message);
    res.status(500).json({
      found: false,
      count: 0,
      error: 'Unable to scan at this moment. Please try again later.'
    });
  }
});

// ==================== Serve Frontend ====================
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
