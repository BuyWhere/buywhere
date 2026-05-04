import http from 'k6/http';

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '20s', target: 100 },
    { duration: '10s', target: 0 },
  ],
};

export default function () {
  http.get('http://localhost:8000/health');
}
