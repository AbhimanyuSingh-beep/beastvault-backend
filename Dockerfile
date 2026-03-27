FROM node:20-alpine

# Install FFmpeg and FFprobe
RUN apk add --no-cache ffmpeg

# Force Linux paths
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 4000

CMD ["npm", "start"]