FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache hledger
WORKDIR /app
COPY --from=build /app/.output .output/
COPY --from=build /app/test-data ./test-data/
ENV LEDGER_FILE=test-data/sample.journal
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
