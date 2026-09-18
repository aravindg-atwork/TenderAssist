// renderer/src/App.tsx
import { JobList } from './components/JobList';

export function App() {
  // Task 5 replaces this no-op with real job-detail navigation.
  return <JobList onSelectJob={() => {}} />;
}
