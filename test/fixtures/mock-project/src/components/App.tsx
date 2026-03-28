import React, { useEffect, useState } from 'react';
import { useCallback, useMemo } from 'react';

interface AppProps {
  title: string;
  onInit?: () => void;
}

export const App: React.FC<AppProps> = ({ title, onInit }) => {
  const [count, setCount] = useState(0);
  const [data, setData] = useState<string[]>([]);

  useEffect(() => {
    console.log('App mounted');
    onInit?.();
    return () => console.log('App unmounted');
  }, [onInit]);

  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(setData);
  }, []);

  const doubled = useMemo(() => count * 2, [count]);

  const handleClick = useCallback(() => {
    setCount(prev => prev + 1);
  }, []);

  return (
    <div className="app">
      <h1>{title}</h1>
      <p>Count: {count}, Doubled: {doubled}</p>
      <button onClick={handleClick}>Increment</button>
      {data.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </div>
  );
};

export default App;
