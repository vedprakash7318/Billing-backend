/**
 * Calculate dynamic start and end dates based on duration types
 */
function calculateSubscriptionDates(durationType, durationValue = 1, startDateInput = null) {
  const startDate = startDateInput ? new Date(startDateInput) : new Date();
  const endDate = new Date(startDate);
  const val = Math.max(1, Number(durationValue) || 1);

  switch (durationType) {
    case 'DAILY':
      endDate.setDate(endDate.getDate() + val);
      break;

    case 'WEEKLY':
      endDate.setDate(endDate.getDate() + val * 7);
      break;

    case 'MONTHLY':
      endDate.setMonth(endDate.getMonth() + val);
      break;

    case 'YEARLY':
      endDate.setFullYear(endDate.getFullYear() + val);
      break;

    case 'CUSTOM_DAYS':
      endDate.setDate(endDate.getDate() + val);
      break;

    case 'LIFETIME':
      endDate.setFullYear(endDate.getFullYear() + 25);
      break;

    default:
      endDate.setDate(endDate.getDate() + 30);
      break;
  }

  return { startDate, endDate };
}

function formatDurationLabel(durationType, durationValue = 1) {
  const val = Number(durationValue) || 1;
  switch (durationType) {
    case 'DAILY':
      return `${val} ${val === 1 ? 'Day' : 'Days'}`;
    case 'WEEKLY':
      return `${val} ${val === 1 ? 'Week' : 'Weeks'}`;
    case 'MONTHLY':
      return `${val} ${val === 1 ? 'Month' : 'Months'}`;
    case 'YEARLY':
      return `${val} ${val === 1 ? 'Year' : 'Years'}`;
    case 'CUSTOM_DAYS':
      return `${val} Custom Days`;
    case 'LIFETIME':
      return 'Lifetime Access';
    default:
      return `${val} Days`;
  }
}

module.exports = {
  calculateSubscriptionDates,
  formatDurationLabel,
};
