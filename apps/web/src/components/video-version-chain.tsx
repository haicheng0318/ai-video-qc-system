import Link from 'next/link';
import React from 'react';

type VersionLink = { id: string; title: string; status: string; version: number };

export function VideoVersionChain({
  currentId,
  chain,
  parent,
  revisions,
}: {
  currentId: string;
  chain: VersionLink[];
  parent: VersionLink | null;
  revisions: VersionLink[];
}) {
  return (
    <section className="panel section-gap">
      <h2>版本关系</h2>
      <div className="version-summary">
        <p>当前版本：V{chain.find((item) => item.id === currentId)?.version || '-'}</p>
        <p>上一版本：{parent ? <Link href={`/videos/${parent.id}`}>V{parent.version} · {parent.title}</Link> : '无'}</p>
        <p>直接返修版本：{revisions.length > 0 ? revisions.map((item) => (
          <Link key={item.id} href={`/videos/${item.id}`}>V{item.version} · {item.title}</Link>
        )) : '无'}</p>
      </div>
      <div className="version-chain">
        {chain.map((item) => (
          <Link className={item.id === currentId ? 'current' : ''} key={item.id} href={`/videos/${item.id}`}>
            V{item.version}<span>{item.status}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
