const jwt = require('jsonwebtoken');

const autenticar = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuarioId = decoded.id;
    req.usuarioEmail = decoded.email;
    
    next();
  } catch (erro) {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
};

module.exports = { autenticar }; 
