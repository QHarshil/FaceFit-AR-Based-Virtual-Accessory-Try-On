# Build context is the repository root so the build can include packages/cv,
# which the frontend bundles from source and type-checks through generated
# declarations.
FROM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY packages/cv/src /app/packages/cv/src
COPY packages/cv/tsconfig.json packages/cv/tsconfig.types.json /app/packages/cv/
COPY frontend/ ./
ARG VITE_API_URL=http://localhost:5055
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.30-alpine
# connect-src in the CSP. VITE_API_URL is an origin (scheme, host, port) here.
ARG VITE_API_URL=http://localhost:5055
ENV API_ORIGIN=$VITE_API_URL
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
