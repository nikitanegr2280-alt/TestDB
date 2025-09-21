const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Настройки MongoDB
const MONGODB_URI = 'mongodb+srv://admin:password@cluster0.mongodb.net/onyxhub?retryWrites=true&w=majority';

// Подключение к MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB подключена'))
.catch(err => console.error('Ошибка подключения к MongoDB:', err));

// Схемы Mongoose
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});

const keySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  userId: { type: String },
  subscriptionType: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  isActive: { type: Boolean, default: true },
  isPermanent: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);
const Key = mongoose.model('Key', keySchema);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 часа
}));

// Установка движка шаблонов
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware для проверки аутентификации
const requireAuth = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Маршруты
app.get('/', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;
    
    const keys = await Key.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalKeys = await Key.countDocuments();
    const totalPages = Math.ceil(totalKeys / limit);
    
    res.render('index', {
      user: req.session.user,
      keys,
      currentPage: page,
      totalPages,
      message: req.query.message
    });
  } catch (error) {
    console.error('Ошибка загрузки ключей:', error);
    res.status(500).render('index', {
      user: req.session.user,
      keys: [],
      error: 'Ошибка загрузки данных'
    });
  }
});

app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.render('login', { error: 'Неверные учетные данные' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('login', { error: 'Неверные учетные данные' });
    }
    
    req.session.user = {
      id: user._id,
      username: user.username,
      role: user.role
    };
    
    res.redirect('/');
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.render('login', { error: 'Ошибка сервера' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.post('/keys', requireAuth, async (req, res) => {
  try {
    const { subscriptionType, expiresAt, isPermanent } = req.body;
    
    const newKey = new Key({
      key: uuidv4(),
      subscriptionType,
      expiresAt: isPermanent ? null : new Date(expiresAt),
      isPermanent: isPermanent === 'on'
    });
    
    await newKey.save();
    res.redirect('/?message=Ключ успешно создан');
  } catch (error) {
    console.error('Ошибка создания ключа:', error);
    res.redirect('/?message=Ошибка создания ключа');
  }
});

app.delete('/keys/:id', requireAuth, async (req, res) => {
  try {
    await Key.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Ключ удален' });
  } catch (error) {
    console.error('Ошибка удаления ключа:', error);
    res.status(500).json({ success: false, message: 'Ошибка удаления ключа' });
  }
});

app.post('/keys/:id/toggle', requireAuth, async (req, res) => {
  try {
    const key = await Key.findById(req.params.id);
    key.isActive = !key.isActive;
    await key.save();
    
    res.json({ 
      success: true, 
      message: `Ключ ${key.isActive ? 'активирован' : 'деактивирован'}`,
      isActive: key.isActive 
    });
  } catch (error) {
    console.error('Ошибка изменения статуса ключа:', error);
    res.status(500).json({ success: false, message: 'Ошибка изменения статуса' });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// Функция для удаления просроченных ключей
setInterval(async () => {
  try {
    const result = await Key.deleteMany({
      isPermanent: false,
      expiresAt: { $lt: new Date() }
    });
    
    if (result.deletedCount > 0) {
      console.log(`Удалено ${result.deletedCount} просроченных ключей`);
    }
  } catch (error) {
    console.error('Ошибка удаления просроченных ключей:', error);
  }
}, 60 * 60 * 1000); // Каждый час
