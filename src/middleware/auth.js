const jwt = require('jsonwebtoken');

// Checks if the user is logged in before allowing an action (like uploading)
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — login required!' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Adds user info to the request
    next(); // Lets the user proceed
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Used for pages that change if you are logged in, but don't REQUIRE it
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {}
  }
  next();
};

const signToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

module.exports = { requireAuth, optionalAuth, signToken };