import { redirect } from 'next/navigation';

export default function LaunchesRoute() {
  redirect('/launch?tab=history');
}
