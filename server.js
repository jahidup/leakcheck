require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
app.use(express.static('public'));

// ==================== MongoDB Models ====================
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: String,
  passwordHash: String,
  coins: { type: Number, default: 5 },
  dailySearches: { type: Number, default: 0 },
  lastResetDate: { type: String, default: () => new Date().toDateString() },
  referralCode: { type: String, unique: true },
  referredBy: String,
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const searchLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: String,
  type: String,
  query: String,
  found: Boolean,
  count: Number,
  ip: String,
  userAgent: String,
  deviceInfo: String,
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const SearchLog = mongoose.model('SearchLog', searchLogSchema);

// ==================== Connect MongoDB ====================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// Helper: generate referral code
function generateReferralCode() {
  return 'REF' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Reset daily searches for all users (run every hour)
async function resetDailySearches() {
  const today = new Date().toDateString();
  await User.updateMany(
    { lastResetDate: { $ne: today } },
    { $set: { dailySearches: 0, lastResetDate: today } }
  );
}
setInterval(resetDailySearches, 60 * 60 * 1000);

// Create default admin user if not exists
async function createAdminIfNotExists() {
  const adminExists = await User.findOne({ username: process.env.ADMIN_USERNAME || 'Shahid_Ansari' });
  if (!adminExists) {
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Tracker@3739', 10);
    await User.create({
      username: process.env.ADMIN_USERNAME || 'Shahid_Ansari',
      passwordHash,
      email: 'admin@nullprotocol.com',
      coins: 99999,
      referralCode: generateReferralCode(),
      isAdmin: true
    });
    console.log('✅ Default admin user created');
  }
}

// ==================== API Configuration ====================
const API_CONFIG = {
  mobile: {
    url: 'https://ayaanmods.site/number.php?key=annonymous&number={}',
    extractCount: (data) => {
      if (data && typeof data === 'object') {
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
    extractCount: (data) => {
      if (data && data.tag) return 1;
      return Object.keys(data).length > 0 ? 1 : 0;
    }
  },
  vehicle: {
    url: 'https://vehicle-info-aco-api.vercel.app/info?vehicle={}',
    extractCount: (data) => {
      if (data && data.registration_number) return 1;
      return (data && !data.error && Object.keys(data).length > 0) ? 1 : 0;
    }
  },
  ration: {
    url: 'https://number8899.vercel.app/?type=family&aadhar={}',
    extractCount: (data) => {
      if (data && data.family_members && Array.isArray(data.family_members)) return data.family_members.length;
      return (data && !data.error && Object.keys(data).length > 0) ? 1 : 0;
    }
  }
};

// ==================== Auth Middleware ====================
function authUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ==================== User Routes ====================
app.post('/api/register', async (req, res) => {
  const { username, email, password, referral } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  
  const existing = await User.findOne({ username });
  if (existing) return res.status(409).json({ error: 'Username already taken' });
  
  const passwordHash = await bcrypt.hash(password, 10);
  let referredByUser = null;
  if (referral) {
    referredByUser = await User.findOne({ referralCode: referral });
  }
  
  const newUser = new User({
    username,
    email,
    passwordHash,
    referralCode: generateReferralCode(),
    referredBy: referredByUser ? referredByUser.username : null,
    coins: referredByUser ? 7 : 5
  });
  await newUser.save();
  
  if (referredByUser) {
    referredByUser.coins += 2;
    await referredByUser.save();
  }
  
  const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ 
    token, 
    user: { 
      username: newUser.username, 
      coins: newUser.coins, 
      referralCode: newUser.referralCode, 
      isAdmin: newUser.isAdmin 
    } 
  });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  
  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ 
    token, 
    user: { 
      username: user.username, 
      coins: user.coins, 
      referralCode: user.referralCode, 
      isAdmin: user.isAdmin 
    } 
  });
});

app.get('/api/me', authUser, async (req, res) => {
  const user = await User.findById(req.userId).select('-passwordHash');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ==================== Search API (with coin deduction & logging) ====================
app.get('/api/check', authUser, async (req, res) => {
  const { type, input } = req.query;
  if (!type || !input) return res.status(400).json({ error: 'Missing type or input' });
  
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Daily free search limit (first 3 searches free)
  const today = new Date().toDateString();
  if (user.lastResetDate !== today) {
    user.dailySearches = 0;
    user.lastResetDate = today;
  }
  let cost = 1;
  if (user.dailySearches < 3) cost = 0;
  
  if (cost > 0 && user.coins < cost) {
    return res.status(402).json({ error: 'Insufficient coins', coins: user.coins, need: cost });
  }

  const config = API_CONFIG[type];
  if (!config) return res.status(400).json({ error: 'Invalid search type' });

  try {
    const url = config.url.replace('{}', encodeURIComponent(input));
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;
    const count = config.extractCount(data) || 0;
    const found = count > 0;

    if (cost > 0) user.coins -= cost;
    user.dailySearches += 1;
    await user.save();

    // Log search details
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = `${req.headers['sec-ch-ua-platform'] || ''} ${req.headers['sec-ch-ua-mobile'] ? 'Mobile' : 'Desktop'}`;
    
    await SearchLog.create({
      userId: user._id,
      username: user.username,
      type,
      query: input,
      found,
      count,
      ip,
      userAgent,
      deviceInfo
    });

    res.json({
      found,
      count,
      message: found
        ? '⚠️ Your data may be exposed in public or unsecured databases'
        : '✅ No data found in scanned sources',
      coinsLeft: user.coins
    });
  } catch (error) {
    console.error('Search API error:', error.message);
    res.status(500).json({ error: 'Scan failed. Please try again later.' });
  }
});

// ==================== History & Referral ====================
app.get('/api/history', authUser, async (req, res) => {
  const logs = await SearchLog.find({ userId: req.userId }).sort({ timestamp: -1 }).limit(50);
  res.json(logs);
});

app.post('/api/referral/claim', authUser, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const baseUrl = process.env.BASE_URL || 'https://yourdomain.com';
  const link = `${baseUrl}?ref=${user.referralCode}`;
  res.json({ referralLink: link, coins: user.coins });
});

// ==================== Admin Routes (4-step login check) ====================
const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'Shahid_Ansari',
  password: process.env.ADMIN_PASSWORD || 'Tracker@3739',
  pin: process.env.ADMIN_PIN || '2744',
  securityKey: process.env.ADMIN_SECURITY_KEY || 'NULL_PROTOCOL'
};

app.post('/admin/login', (req, res) => {
  const { username, password, pin, key } = req.body;
  if (username === ADMIN_CREDENTIALS.username &&
      password === ADMIN_CREDENTIALS.password &&
      pin === ADMIN_CREDENTIALS.pin &&
      key === ADMIN_CREDENTIALS.securityKey) {
    // Generate a simple admin token (you can also use JWT)
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Invalid admin credentials' });
  }
});

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) throw new Error();
    next();
  } catch (err) {
    res.status(403).json({ error: 'Admin access required' });
  }
}

app.get('/admin/users', adminAuth, async (req, res) => {
  const users = await User.find().select('-passwordHash');
  res.json(users);
});

app.get('/admin/logs', adminAuth, async (req, res) => {
  const { limit = 200, userId } = req.query;
  const filter = userId ? { userId } : {};
  const logs = await SearchLog.find(filter).sort({ timestamp: -1 }).limit(parseInt(limit));
  res.json(logs);
});

app.post('/admin/add-coins', adminAuth, async (req, res) => {
  const { username, amount } = req.body;
  if (!username || !amount) return res.status(400).json({ error: 'Username and amount required' });
  const user = await User.findOne({ username });
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.coins += amount;
  await user.save();
  res.json({ success: true, coins: user.coins });
});

// ==================== Serve Frontend ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Pro server running on port ${PORT}`);
  await createAdminIfNotExists();
});
