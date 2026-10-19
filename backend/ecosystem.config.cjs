module.exports = {
  apps: [
    {
      name: "autoshop-api",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      watch: false,
      max_memory_restart: "500M",
      error_file: "./logs/api-err.log",
      out_file: "./logs/api-out.log",
      time: true,
    },
    {
      name: "autoshop-worker",
      script: "./dist/worker/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      watch: false,
      max_memory_restart: "300M",
      error_file: "./logs/worker-err.log",
      out_file: "./logs/worker-out.log",
      time: true,
    },
  ],
};
