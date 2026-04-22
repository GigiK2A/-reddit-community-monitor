FROM apify/actor-node-playwright-chrome:20

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . ./