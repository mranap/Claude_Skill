import { z } from 'zod';

let configured = false;

/**
 * Friendlier default validation messages for the browser. Messages written in the shared schemas
 * (e.g. "Use at least 10 characters") still take precedence; this only replaces zod's generic defaults
 * such as "Too small: expected number to be >=15".
 */
export function configureZod(): void {
  if (configured) return;
  configured = true;
  z.config({
    customError: (issue) => {
      switch (issue.code) {
        case 'invalid_type': {
          const input = issue.input;
          if (
            input === undefined ||
            input === null ||
            input === '' ||
            (typeof input === 'number' && Number.isNaN(input))
          ) {
            return 'Required';
          }
          if (issue.expected === 'number' || issue.expected === 'int') return 'Enter a number';
          return undefined;
        }
        case 'too_small': {
          const min = Number(issue.minimum);
          if (issue.origin === 'string') return min <= 1 ? 'Required' : `Use at least ${min} characters`;
          if (issue.origin === 'array' || issue.origin === 'set')
            return min <= 1 ? 'Add at least one item' : `Add at least ${min} items`;
          if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') {
            return issue.inclusive === false ? `Must be greater than ${min}` : `Must be at least ${min}`;
          }
          return undefined;
        }
        case 'too_big': {
          const max = Number(issue.maximum);
          if (issue.origin === 'string') return `Use at most ${max} characters`;
          if (issue.origin === 'array' || issue.origin === 'set') return `Add at most ${max} items`;
          if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') {
            return issue.inclusive === false ? `Must be less than ${max}` : `Must be at most ${max}`;
          }
          return undefined;
        }
        case 'invalid_format':
          if (issue.input === '' || issue.input === undefined) return 'Required';
          if (issue.format === 'email') return 'Enter a valid e-mail address';
          if (issue.format === 'url') return 'Enter a valid URL';
          return 'Invalid format';
        case 'invalid_value':
          return 'Choose one of the available options';
        default:
          return undefined;
      }
    },
  });
}
