import React from 'react';

export const Err: React.FC<{ msg: string }> = ({ msg }) =>
  msg ? (
    <div role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
      {msg}
    </div>
  ) : null;
