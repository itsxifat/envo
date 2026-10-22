function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

const production = process.env.NODE_ENV === 'production';

export const config = {
  production,
  port: Number(env('PORT', '4310')),
  host: env('HOST', '127.0.0.1'),
  databaseUrl: env('DATABASE_URL'),
  jwtSecret: env('JWT_SECRET'),
  cookieSecure: env('COOKIE_SECURE', production ? 'true' : 'false') === 'true',
  publicHost: env('PUBLIC_HOST', 'localhost'),
  /** Hostname phones and the browser phone use for SIP (may differ from the dashboard host). */
  sipDomain: env('SIP_DOMAIN', env('PUBLIC_HOST', 'localhost')),
  publicIp: env('PUBLIC_IP', '127.0.0.1'),
  /** Base URL browsers and payment gateways use to reach the dashboard (payment callbacks). */
  publicUrl: env('PUBLIC_URL', `https://${env('PUBLIC_HOST', 'localhost')}`).replace(/\/$/, ''),
  /** Enfinito Pay's API (pay.enfinito.com); overridden only to test against a local stand-in. */
  enfinitoPayApi: env('ENFINITO_PAY_API', 'https://pay.enfinito.com/api/v1').replace(/\/$/, ''),
  ami: {
    host: env('AMI_HOST', '127.0.0.1'),
    port: Number(env('AMI_PORT', '5038')),
    user: env('AMI_USER', 'envo'),
    secret: env('AMI_SECRET'),
  },
  paths: {
    confDir: env('ASTERISK_CONF_DIR', '/etc/asterisk/envo'),
    soundsDir: env('ASTERISK_SOUNDS_DIR', '/var/lib/asterisk/sounds/envo'),
    monitorDir: env('ASTERISK_MONITOR_DIR', '/var/spool/asterisk/monitor/envo'),
    voicemailDir: env('ASTERISK_VOICEMAIL_DIR', '/var/spool/asterisk/voicemail'),
    dataDir: env('ENVO_DATA_DIR', '/var/lib/envo'),
    ffmpeg: env('FFMPEG_PATH', '/usr/bin/ffmpeg'),
    piperDir: env('PIPER_DIR', '/opt/envo/piper'),
  },
};
