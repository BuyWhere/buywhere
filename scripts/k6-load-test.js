import http from 'k6/http';

export const options = {
  vus: 5,
  duration: '30s',
};

export default function () {
  http.get('https://buywhere-api-3cjo6zft4q-as.a.run.app/health');
}
