FROM mcr.microsoft.com/playwright:v1.58.2-noble

# The base image deliberately ships browsers but no Node library.  Keep the
# browser driver version pinned to the browser image used by the proof.
RUN npm install --global playwright-core@1.58.2
