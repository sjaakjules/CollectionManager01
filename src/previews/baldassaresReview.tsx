import { createRoot } from 'react-dom/client';
import { PreviewReview } from './PreviewReview';

// Close the review after applying the downloaded edits to the catalogue.
const reviewOpen = true;
const root = document.getElementById('review-root');
if (root) createRoot(root).render(<PreviewReview editable={reviewOpen} />);
