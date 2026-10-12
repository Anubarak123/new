import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
    }
  }
}

export function requireProfessor(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized, no token provided." });
    }
    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; role: string };
    if (payload.role !== "professor") {
      return res.status(403).json({ message: "Forbidden, professor access only." });
    }
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}
