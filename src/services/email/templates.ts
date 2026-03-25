export type EmailTemplateName = 'USER_INVITED' | 'API_KEY_ROTATED' | 'RATE_LIMIT_WARNING';

interface TemplateResult {
  subject: string;
  body: string;
}

const templates: Record<EmailTemplateName, (context: any) => TemplateResult> = {
  USER_INVITED: (context) => ({
    subject: 'You have been invited!',
    body: `Hello, you have been invited to join the platform. Click here: ${context.inviteLink}`
  }),
  API_KEY_ROTATED: (context) => ({
    subject: 'Security Alert: API Key Rotated',
    body: `Your API key has been rotated. If you did not perform this action, contact support immediately. New key rotates in ${context.overlapMinutes} minutes.`
  }),
  RATE_LIMIT_WARNING: (context) => ({
    subject: 'Urgent: API Rate Limit Warning',
    body: `Your tenant (${context.tenantName}) is approaching its global rate limit. Current usage: ${context.currentUsage}/${context.limit}.`
  })
};

export const getTemplate = (name: EmailTemplateName, context: any): TemplateResult => {
  const template = templates[name];
  if (!template) {
    throw new Error(`Template ${name} not found`);
  }
  return template(context);
};
