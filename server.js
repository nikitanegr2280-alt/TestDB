const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/onyxhub';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Static API key (should be stored in environment variables in production)
const STATIC_API_KEY = process.env.API_KEY || 'onyxhub-secret-key-2024';

// Subscription Schema
const subscriptionSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: Number,
    required: true
  },
  username: String,
  firstName: String,
  lastName: String,
  subscriptionType: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  isFrozen: {
    type: Boolean,
    default: false
  },
  frozenDays: {
    type: Number,
    default: 0
  },
  lastChecked: {
    type: Date,
    default: Date.now
  }
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Middleware to verify API key
const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey || apiKey !== STATIC_API_KEY) {
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid API key' 
    });
  }
  
  next();
};

// Routes

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Onyx Hub API Server is running',
    version: '1.0.0'
  });
});

// Get all active subscriptions with key information
app.get('/users/user/connect/:key', verifyApiKey, async (req, res) => {
  try {
    const { key } = req.params;
    
    const subscription = await Subscription.findOne({ 
      key, 
      isActive: true 
    });
    
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription key not found or expired'
      });
    }
    
    // Check if subscription is expired
    if (subscription.expiresAt && subscription.expiresAt < new Date()) {
      subscription.isActive = false;
      await subscription.save();
      
      return res.status(410).json({
        success: false,
        message: 'Subscription key has expired'
      });
    }
    
    // Update last checked timestamp
    subscription.lastChecked = new Date();
    await subscription.save();
    
    res.json({
      success: true,
      data: {
        key: subscription.key,
        userId: subscription.userId,
        username: subscription.username,
        firstName: subscription.firstName,
        lastName: subscription.lastName,
        subscriptionType: subscription.subscriptionType,
        createdAt: subscription.createdAt,
        expiresAt: subscription.expiresAt,
        isActive: subscription.isActive,
        isFrozen: subscription.isFrozen,
        frozenDays: subscription.frozenDays,
        lastChecked: subscription.lastChecked
      }
    });
    
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create new subscription key
app.post('/subscriptions', verifyApiKey, async (req, res) => {
  try {
    const {
      userId,
      username,
      firstName,
      lastName,
      subscriptionType,
      key,
      durationDays
    } = req.body;
    
    if (!userId || !subscriptionType || !key) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, subscriptionType, key'
      });
    }
    
    // Calculate expiration date
    let expiresAt = null;
    if (durationDays && durationDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);
    }
    
    const subscription = new Subscription({
      key,
      userId,
      username,
      firstName,
      lastName,
      subscriptionType,
      expiresAt,
      isActive: true
    });
    
    await subscription.save();
    
    res.status(201).json({
      success: true,
      message: 'Subscription key created successfully',
      data: subscription
    });
    
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Subscription key already exists'
      });
    }
    
    console.error('Error creating subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update subscription (freeze/unfreeze, extend, etc.)
app.put('/subscriptions/:key', verifyApiKey, async (req, res) => {
  try {
    const { key } = req.params;
    const updates = req.body;
    
    const subscription = await Subscription.findOne({ key });
    
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription key not found'
      });
    }
    
    // Update fields
    Object.keys(updates).forEach(field => {
      if (field in subscription.schema.paths) {
        subscription[field] = updates[field];
      }
    });
    
    await subscription.save();
    
    res.json({
      success: true,
      message: 'Subscription updated successfully',
      data: subscription
    });
    
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete subscription key
app.delete('/subscriptions/:key', verifyApiKey, async (req, res) => {
  try {
    const { key } = req.params;
    
    const result = await Subscription.findOneAndDelete({ key });
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Subscription key not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Subscription key deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all subscriptions (with optional filtering)
app.get('/subscriptions', verifyApiKey, async (req, res) => {
  try {
    const { userId, isActive, subscriptionType } = req.query;
    const filter = {};
    
    if (userId) filter.userId = parseInt(userId);
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (subscriptionType) filter.subscriptionType = subscriptionType;
    
    const subscriptions = await Subscription.find(filter).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: subscriptions.length,
      data: subscriptions
    });
    
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Cleanup expired subscriptions (can be called periodically)
app.post('/subscriptions/cleanup', verifyApiKey, async (req, res) => {
  try {
    const result = await Subscription.updateMany(
      { 
        expiresAt: { $lt: new Date() },
        isActive: true 
      },
      { 
        isActive: false 
      }
    );
    
    res.json({
      success: true,
      message: `Deactivated ${result.modifiedCount} expired subscriptions`
    });
    
  } catch (error) {
    console.error('Error cleaning up subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Cleanup expired subscriptions every hour
setInterval(async () => {
  try {
    const result = await Subscription.updateMany(
      { 
        expiresAt: { $lt: new Date() },
        isActive: true 
      },
      { 
        isActive: false 
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`Cleaned up ${result.modifiedCount} expired subscriptions`);
    }
  } catch (error) {
    console.error('Error in scheduled cleanup:', error);
  }
}, 60 * 60 * 1000); // Every hour
