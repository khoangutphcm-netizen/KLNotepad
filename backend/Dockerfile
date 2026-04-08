FROM node:18

WORKDIR /app

# Chỉ copy package.json vào trước
COPY backend/package*.json ./backend/

# Cài đặt thư viện TRONG môi trường Linux của Docker
RUN cd backend && npm install

# Copy toàn bộ code (Lúc này Docker sẽ tự bỏ qua node_modules nhờ file .dockerignore ở trên)
COPY . .

WORKDIR /app/backend

EXPOSE 3000

CMD ["node", "app.js"]