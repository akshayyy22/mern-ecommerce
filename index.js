require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const cookieParser = require('cookie-parser');
const path = require('path');

const { createProduct } = require('./controller/Product');
const productsRouter = require('./routes/Products');
const categoriesRouter = require('./routes/Categories');
const brandsRouter = require('./routes/Brands');
const usersRouter = require('./routes/Users');
const authRouter = require('./routes/Auth');
const cartRouter = require('./routes/Cart');
const ordersRouter = require('./routes/Order');
const { User } = require('./model/User');
const { isAuth, sanitizeUser, cookieExtractor } = require('./services/common');
const { Order } = require('./model/Order');

const server = express();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Initialize MongoStore
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URL,
});

// Create session middleware
server.use(
  session({
    secret: process.env.SESSION_KEY,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

// Middleware
server.use(cookieParser());
server.use(passport.initialize());
server.use(passport.session());
server.use(cors({ exposedHeaders: ['X-Total-Count'] }));
server.use(express.json());

// Routes
server.use('/products', isAuth(), productsRouter.router);
server.use('/categories', isAuth(), categoriesRouter.router);
server.use('/brands', isAuth(), brandsRouter.router);
server.use('/users', isAuth(), usersRouter.router);
server.use('/auth', authRouter.router);
server.use('/cart', isAuth(), cartRouter.router);
server.use('/orders', isAuth(), ordersRouter.router);

// Serve static files
server.use(express.static(path.resolve(__dirname, 'build')));

// Handle other routes with React router
server.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'build', 'index.html'));
});

// Passport Strategies
passport.use(
  'local',
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await User.findOne({ email: email });
      if (!user) {
        return done(null, false, { message: 'Invalid credentials' });
      }
      crypto.pbkdf2(password, user.salt, 310000, 32, 'sha256', (err, hashedPassword) => {
        if (err) {
          return done(err);
        }
        if (!crypto.timingSafeEqual(user.password, hashedPassword)) {
          return done(null, false, { message: 'Invalid credentials' });
        }
        const token = jwt.sign(sanitizeUser(user), process.env.JWT_SECRET_KEY);
        return done(null, { id: user.id, role: user.role, token });
      });
    } catch (err) {
      return done(err);
    }
  })
);

passport.use(
  'jwt',
  new JwtStrategy(
    {
      jwtFromRequest: cookieExtractor,
      secretOrKey: process.env.JWT_SECRET_KEY,
    },
    async (jwt_payload, done) => {
      try {
        const user = await User.findById(jwt_payload.id);
        if (user) {
          return done(null, sanitizeUser(user));
        } else {
          return done(null, false);
        }
      } catch (err) {
        return done(err, false);
      }
    }
  )
);

passport.serializeUser((user, cb) => {
  process.nextTick(() => {
    cb(null, { id: user.id, role: user.role });
  });
});

passport.deserializeUser((user, cb) => {
  process.nextTick(() => {
    cb(null, user);
  });
});

// Stripe Payment Integration
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


server.post("/create-payment-intent", async (req, res) => {
  const { totalAmount } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: "inr",
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.send ({
      clientSecret: paymentIntent.client_secret ,
    })
  });
// Error handling middleware
server.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
