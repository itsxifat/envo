import { Ami } from './ami.js';
import { config } from '../config.js';

/** The process-wide AMI connection to the local Asterisk. */
export const ami = new Ami(config.ami);
