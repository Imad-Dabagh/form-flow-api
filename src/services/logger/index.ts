type LogMetadata = unknown[];

const Logger = {
  info(message: string, ...metadata: LogMetadata): void {
    console.info(message, ...metadata);
  },
  warn(message: string, ...metadata: LogMetadata): void {
    console.warn(`⚠️ ${message}`, ...metadata);
  },
  error(message: string, ...metadata: LogMetadata): void {
    console.error(`🚨 ${message}`, ...metadata);
  },
  debug(message: string, ...metadata: LogMetadata): void {
    console.debug(message, ...metadata);
  },
};

export default Logger;
