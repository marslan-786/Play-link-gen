# Node.js کا ہلکا پھلکا ورژن
FROM node:18-alpine

# FFmpeg کو انسٹال کریں
RUN apk update && apk add --no-cache ffmpeg

# ورکنگ ڈائریکٹری سیٹ کریں
WORKDIR /app

# پیکج فائلز کاپی کریں اور انسٹال کریں
COPY package*.json ./
RUN npm install

# باقی سارا کوڈ کاپی کریں
COPY . .

# پورٹ ایکسپوز کریں
EXPOSE 8080

# سرور سٹارٹ کرنے کی کمانڈ
CMD ["npm", "start"]
