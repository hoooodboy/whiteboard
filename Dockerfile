FROM node:20 AS build

WORKDIR /opt/node_app/workspace/white-board

# COPY package.json yarn.lock ./
RUN yarn --ignore-optional --network-timeout 600000

ARG NODE_ENV=development

RUN apt update -y && apt-get install -y xdg-utils


ENTRYPOINT ["yarn", "start"]

 
 
 


# FROM node:18 AS build
# 
# WORKDIR /opt/node_app
# 
# COPY package.json yarn.lock ./
# RUN yarn --ignore-optional --network-timeout 600000
# 
# ARG NODE_ENV=production
# 
# COPY . .
# RUN yarn build:app:docker
# 
# FROM nginx:1.21-alpine
# 
# COPY --from=build /opt/node_app/build /usr/share/nginx/html
# 
# HEALTHCHECK CMD wget -q -O /dev/null http://localhost || exit 1
