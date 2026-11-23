FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://localhost:5055
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.30-alpine
# connect-src in the CSP. VITE_API_URL is an origin (scheme, host, port) here.
ARG VITE_API_URL=http://localhost:5055
ENV API_ORIGIN=$VITE_API_URL
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
