import type { Metadata } from 'next';
import './style.css';

export const metadata: Metadata = {
	title: 'Octane on Next.js',
	description: 'Next App Router and Cache Components with an Octane client island',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
